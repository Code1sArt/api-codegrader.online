import { UsageService } from "../members/usage.service";
import {
  ConflictException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../prisma/prisma.service";
import { AuthService } from "./auth.service";

describe("AuthService Google sign-in", () => {
  afterEach(() => jest.restoreAllMocks());

  it("reports an unconfigured Client ID before verifying a token", async () => {
    const config = {
      get: (key: string) =>
        key === "GOOGLE_CLIENT_ID"
          ? "your-client-id.apps.googleusercontent.com"
          : "",
    } as ConfigService;
    const service = new AuthService(
      {} as PrismaService,
      {} as JwtService,
      config,
      {} as UsageService,
    );

    await expect(service.loginWithGoogle("token")).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it("does not relink an existing email to a different Google account", async () => {
    const create = jest.fn();
    const update = jest.fn();
    const prisma = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ googleSub: "original-google-sub" }),
        create,
        update,
      },
    } as unknown as PrismaService;
    const config = {
      get: (key: string) =>
        key === "GOOGLE_CLIENT_ID"
          ? "123456-example.apps.googleusercontent.com"
          : "",
    } as ConfigService;
    const service = new AuthService(
      prisma,
      {} as JwtService,
      config,
      {} as UsageService,
    );
    Object.assign(service, {
      google: {
        verifyIdToken: jest.fn().mockResolvedValue({
          getPayload: () => ({
            sub: "new-google-sub",
            email: "student@example.com",
            email_verified: true,
          }),
        }),
      },
    });

    await expect(service.loginWithGoogle("token")).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
  it.each([
    { isActive: false, deletedAt: null },
    { isActive: true, deletedAt: new Date() },
  ])(
    "does not update or issue a session for a blocked/deleted account: %j",
    async (account) => {
      const update = jest.fn();
      const create = jest.fn();
      const signAsync = jest.fn();
      const record = jest.fn();
      const findUnique = jest
        .fn()
        .mockResolvedValue({ id: "disabled", ...account });
      const service = new AuthService(
        { user: { findUnique, update, create } } as unknown as PrismaService,
        { signAsync } as unknown as JwtService,
        {
          get: () => "123456-example.apps.googleusercontent.com",
        } as unknown as ConfigService,
        { record } as unknown as UsageService,
      );
      Object.assign(service, {
        google: {
          verifyIdToken: jest
            .fn()
            .mockResolvedValue({
              getPayload: () => ({
                sub: "disabled",
                email: "disabled@example.test",
                email_verified: true,
              }),
            }),
        },
      });
      await expect(service.loginWithGoogle("token")).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(findUnique).toHaveBeenCalledTimes(1);
      expect(update).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
      expect(signAsync).not.toHaveBeenCalled();
      expect(record).not.toHaveBeenCalled();
    },
  );
});
