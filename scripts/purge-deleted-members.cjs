// Upgrade cleanup: only accounts already explicitly deleted, never blocked members.
require("dotenv").config({ quiet: true });
const { PrismaClient } = require("@prisma/client");
const { MembersService } = require("../dist/members/members.service");
const prisma = new PrismaClient();
(async () => {
  const deleted = await prisma.user.findMany({
    where: { deletedAt: { not: null }, role: "USER" },
    select: { id: true },
  });
  if (!deleted.length) {
    console.log("No previously deleted members to remove.");
    return;
  }
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN", isActive: true, deletedAt: null },
    select: { id: true },
  });
  if (!admin)
    throw new Error(
      "An active admin is required to retain shared teaching content.",
    );
  const members = new MembersService(prisma, null);
  for (const user of deleted) await members.remove(user.id, admin.id);
  console.log(
    `Permanently removed ${deleted.length} previously deleted members. Blocked accounts unchanged.`,
  );
})()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
