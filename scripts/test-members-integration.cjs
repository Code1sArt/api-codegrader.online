/* Uses an isolated temporary MySQL database; never migrates the configured database. */
require("reflect-metadata");
require("dotenv").config({ quiet: true });
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");
const { NestFactory } = require("@nestjs/core");
const { ValidationPipe } = require("@nestjs/common");
const { JwtService } = require("@nestjs/jwt");
const { PRIVACY_POLICY } = require("../dist/members/privacy");

async function main() {
  const database = `grader_members_test_${Date.now()}`;
  const root = new PrismaClient();
  let prisma, app;
  await root.$executeRawUnsafe(`CREATE DATABASE \`${database}\``);
  try {
    const url = new URL(process.env.DATABASE_URL);
    url.pathname = `/${database}`;
    process.env.DATABASE_URL = url.toString();
    process.env.JWT_SECRET = "isolated-members-integration-test-secret";
    process.env.GOOGLE_CLIENT_ID = "123456-example.apps.googleusercontent.com";
    const migrated = spawnSync(
      process.execPath,
      [require.resolve("prisma/build/index.js"), "migrate", "deploy"],
      { env: process.env, encoding: "utf8" },
    );
    assert.equal(
      migrated.status,
      0,
      "All migrations must apply to a fresh database",
    );
    prisma = new PrismaClient();
    const createUser = (id, extra = {}) =>
      prisma.user.create({
        data: {
          id,
          googleSub: id,
          email: `${id}@example.test`,
          displayName: id,
          ...extra,
        },
      });
    const consent = {
      privacyVersion: PRIVACY_POLICY.version,
      privacyAcceptedAt: new Date(),
    };
    const admin = await createUser("admin", { role: "ADMIN", ...consent });
    const member = await createUser("member");
    await createUser("other", consent);
    await createUser("zero", consent);
    await createUser("blocked", { ...consent, isActive: false });
    const p = await prisma.problem.create({
      data: {
        id: "p1",
        slug: "one",
        title: "One",
        statement: "Example",
        constraints: "1 ≤ N\nN ≤ 100",
        allowedLanguages: ["PYTHON"],
        status: "PUBLISHED",
        createdById: admin.id,
      },
    });
    await prisma.problem.create({
      data: {
        id: "p2",
        slug: "two",
        title: "Two",
        statement: "Example",
        allowedLanguages: ["PYTHON"],
        status: "PUBLISHED",
        createdById: admin.id,
      },
    });
    const c = await prisma.competition.create({
      data: {
        id: "c1",
        title: "Test",
        status: "PUBLISHED",
        startsAt: new Date(Date.now() - 10000),
        endsAt: new Date(Date.now() + 100000),
        createdById: admin.id,
        problems: { create: { problemId: p.id, score: 100, position: 1 } },
      },
    });
    for (const [userId, problemId, score, extra] of [
      ["member", "p1", 40, {}],
      ["member", "p1", 70, {}],
      ["member", "p1", 65, { competitionId: c.id }],
      ["member", "p2", 30, {}],
      ["member", "p2", 100, { scoreResetAt: new Date() }],
      ["member", "p2", 100, { status: "SYSTEM_ERROR" }],
      ["other", "p1", 100, {}],
      ["blocked", "p1", 100, {}],
    ])
      await prisma.submission.create({
        data: {
          userId,
          problemId,
          score,
          language: "PYTHON",
          sourceCode: "print(1)",
          status: "PARTIAL",
          ...extra,
        },
      });
    const { AppModule } = require("../dist/app.module");
    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix("api");
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl();
    const jwt = app.get(JwtService);
    const tokens = Object.fromEntries(
      await Promise.all(
        ["admin", "member", "other", "blocked"].map(async (id) => [
          id,
          await jwt.signAsync({ sub: id, role: "ADMIN" }),
        ]),
      ),
    );
    async function request(path, id, method = "GET", body, status = 200) {
      const response = await fetch(`${base}/api${path}`, {
        method,
        headers: {
          ...(id ? { Authorization: `Bearer ${tokens[id]}` } : {}),
          "Content-Type": "application/json",
          "X-Forwarded-For": "198.51.100.123",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const data = await response.json();
      assert.equal(
        response.status,
        status,
        `${method} ${path}: ${JSON.stringify(data)}`,
      );
      return data;
    }
    await request("/auth/privacy", null);
    await request("/leaderboard", null, "GET", null, 401);
    assert.equal(
      (await request("/auth/me", "member")).requiresPrivacyAcceptance,
      true,
    );
    assert.equal(
      (await request("/leaderboard", "member", "GET", null, 403)).code,
      "PRIVACY_ACCEPTANCE_REQUIRED",
    );
    await request(
      "/submissions",
      "member",
      "POST",
      { problemId: "p1", language: "PYTHON", sourceCode: "print(1)" },
      403,
    );
    await request(
      "/auth/consent",
      "member",
      "POST",
      { accepted: false, version: PRIVACY_POLICY.version },
      400,
    );
    await request(
      "/auth/consent",
      "member",
      "POST",
      { accepted: true, version: "obsolete" },
      400,
    );
    assert.equal(await prisma.userAccessLog.count(), 0);
    const accepted = await request(
      "/auth/consent",
      "member",
      "POST",
      { accepted: true, version: PRIVACY_POLICY.version },
      201,
    );
    assert.equal(accepted.requiresPrivacyAcceptance, false);
    await request(
      "/auth/consent",
      "member",
      "POST",
      { accepted: true, version: PRIVACY_POLICY.version },
      201,
    );
    assert.equal(
      await prisma.userAccessLog.count(),
      1,
      "Repeat acceptance is idempotent",
    );
    const { UsageService } = require("../dist/members/usage.service");
    const usage = app.get(UsageService);
    const first = await prisma.userAccessLog.findFirst();
    assert.notEqual(
      first.ip,
      "198.51.100.123",
      "Untrusted forwarded IP must not be used",
    );
    await usage.record(member.id, "SUBMISSION", "::ffff:203.0.113.10");
    await usage.record(member.id, "PLAYGROUND", "invalid IP");
    await usage.countGraderRun(member.id);
    const counts = await prisma.userUsage.findUnique({
      where: { userId: member.id },
    });
    assert.deepEqual(
      [
        counts.loginCount,
        counts.submissionCount,
        counts.playgroundCount,
        counts.graderRunCount,
      ],
      [1, 1, 1, 2],
    );
    await prisma.userAccessLog.create({
      data: {
        userId: member.id,
        kind: "LOGIN",
        ip: "203.0.113.1",
        createdAt: new Date(Date.now() - 91 * 86400000),
      },
    });
    const history = await request(`/members/${member.id}/history`, "admin");
    assert.equal(history.total, 3, "Expired IP logs are hidden");
    assert(history.items.some((row) => row.ip === "203.0.113.10"));
    assert(
      history.items.some((row) => row.kind === "PLAYGROUND" && row.ip === null),
    );
    await usage.prune();
    assert.equal(
      await prisma.userAccessLog.count(),
      3,
      "90-day retention removes expired logs",
    );
    const board = await request("/leaderboard", "member");
    assert.equal(
      board.entries.find((row) => row.userId === member.id).totalScore,
      100,
      "Best score per problem, no competition duplicates or reset/system scores",
    );
    assert.equal(board.entries.find((row) => row.userId === "other").rank, 1);
    assert.equal(board.entries.find((row) => row.userId === member.id).rank, 1);
    assert(!board.entries.some((row) => row.userId === "blocked"));
    assert.equal(
      (await request("/problems/p1", "member")).constraints,
      "1 ≤ N\nN ≤ 100",
    );
    await request("/members", "member", "GET", null, 403); // JWT role claim cannot grant admin access.
    await request(
      "/members/admin/status",
      "admin",
      "PATCH",
      { isActive: false },
      400,
    );
    await request("/members/admin", "admin", "DELETE", null, 400);
    await request("/members/member/status", "admin", "PATCH", {
      isActive: false,
    });
    await request("/auth/me", "member", "GET", null, 401);
    const { AuthService } = require("../dist/auth/auth.service");
    const auth = app.get(AuthService);
    Object.assign(auth, {
      google: {
        verifyIdToken: async () => ({
          getPayload: () => ({
            sub: member.googleSub,
            email: member.email,
            name: member.displayName,
            email_verified: true,
          }),
        }),
      },
    });
    await assert.rejects(
      () => auth.loginWithGoogle("mock-google-token"),
      /Account is disabled/,
    );
    await request(
      "/auth/consent",
      "member",
      "POST",
      { accepted: true, version: PRIVACY_POLICY.version },
      401,
    );
    await request("/members/member/status", "admin", "PATCH", {
      isActive: true,
    });
    await request("/auth/me", "member");
    assert.equal(
      (await auth.loginWithGoogle("mock-google-token")).user.id,
      member.id,
      "Unblocking restores Google sign-in to the original account",
    );
    await request("/problems/p1", "other", "DELETE", null, 403);
    await request("/problems/p1", "admin", "DELETE");
    await request("/problems/p1", "member", "GET", null, 404);
    assert(
      !(await request("/problems", "admin")).some((row) => row.id === "p1"),
    );
    assert.equal(
      (await request("/leaderboard", "member")).entries.find(
        (row) => row.userId === member.id,
      ).totalScore,
      30,
    );
    assert.equal(
      (await request("/competitions/c1", "member")).problems.length,
      0,
    );
    await request(
      "/competitions/c1/status",
      "admin",
      "PATCH",
      { status: "PUBLISHED" },
      400,
    );
    await request("/competitions/c1", "admin", "DELETE");
    await request("/competitions/c1", "member", "GET", null, 404);
    assert.equal((await request("/competitions", "admin")).length, 0);
    const competitionAttempt = await prisma.submission.findFirst({
      where: { competitionId: c.id },
    });
    const retainedAttempt = await request(
      `/submissions/${competitionAttempt.id}`,
      "admin",
    );
    assert.equal(retainedAttempt.sourceCode, "print(1)");
    assert(retainedAttempt.problem.deletedAt);
    assert(retainedAttempt.competition.deletedAt);

    await prisma.problem.update({
      where: { id: "p2" },
      data: { createdById: member.id },
    });
    await prisma.competition.update({
      where: { id: c.id },
      data: { createdById: member.id },
    });
    await prisma.competitionParticipant.create({
      data: { competitionId: c.id, userId: member.id },
    });
    await prisma.testCase.create({
      data: {
        id: "result-test",
        problemId: "p1",
        name: "old",
        input: "",
        expectedOutput: "1",
        score: 100,
        position: 1,
      },
    });
    await prisma.submissionResult.create({
      data: {
        submissionId: competitionAttempt.id,
        testCaseId: "result-test",
        status: "ACCEPTED",
        score: 100,
      },
    });
    await request("/members/member", "admin", "DELETE");
    assert.equal(
      (await prisma.problem.findUnique({ where: { id: "p2" } })).createdById,
      admin.id,
    );
    assert.equal(
      (await prisma.competition.findUnique({ where: { id: c.id } }))
        .createdById,
      admin.id,
    );
    await request("/auth/me", "member", "GET", null, 401);
    await request(
      "/members/member/status",
      "admin",
      "PATCH",
      { isActive: true },
      404,
    );

    await request("/members/member/history", "admin", "GET", null, 404);
    assert.equal(
      await prisma.user.findUnique({ where: { id: member.id } }),
      null,
    );
    assert.equal(
      await prisma.submission.count({ where: { userId: member.id } }),
      0,
    );
    assert.equal(
      await prisma.userAccessLog.count({ where: { userId: member.id } }),
      0,
    );
    assert.equal(
      await prisma.userUsage.count({ where: { userId: member.id } }),
      0,
    );
    assert.equal(
      await prisma.competitionParticipant.count({
        where: { userId: member.id },
      }),
      0,
    );
    assert.equal(
      await prisma.submissionResult.count({
        where: { submissionId: competitionAttempt.id },
      }),
      0,
    );
    const newSession = await auth.loginWithGoogle("mock-google-token");
    assert.notEqual(newSession.user.id, member.id);
    assert.equal(newSession.user.requiresPrivacyAcceptance, true);
    assert.equal(newSession.user.privacyAcceptedAt, null);
    assert.equal(
      await prisma.submission.count({ where: { userId: newSession.user.id } }),
      0,
    );
    const newMe = await fetch(`${base}/api/auth/me`, {
      headers: { Authorization: `Bearer ${newSession.accessToken}` },
    });
    assert.equal(newMe.status, 200);
    await request("/auth/me", "member", "GET", null, 401);
    await createUser("legacy-deleted", {
      isActive: false,
      deletedAt: new Date(),
    });
    for (let run = 0; run < 2; run++) {
      const cleanup = spawnSync(
        process.execPath,
        ["scripts/purge-deleted-members.cjs"],
        { env: process.env, encoding: "utf8" },
      );
      assert.equal(
        cleanup.status,
        0,
        "Legacy deletion cleanup must be idempotent",
      );
    }
    assert.equal(
      await prisma.user.findUnique({ where: { id: "legacy-deleted" } }),
      null,
    );
    assert.equal(
      (await prisma.user.findUnique({ where: { id: "blocked" } })).isActive,
      false,
    );
    assert.equal(
      await prisma.user.count({ where: { googleSub: member.googleSub } }),
      1,
    );
    console.log(
      "Members integration passed: migration, consent, authorization, blocking, retention, usage, leaderboard, permanent member deletion and re-registration.",
    );
  } finally {
    if (app) await app.close();
    if (prisma) await prisma.$disconnect();
    await root.$executeRawUnsafe(`DROP DATABASE \`${database}\``);
    await root.$disconnect();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
