import { PrismaClient, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const googleSub = process.env.SEED_ADMIN_GOOGLE_SUB?.trim();
  if (!email || !googleSub) {
    console.log('Skip seed: set SEED_ADMIN_EMAIL and SEED_ADMIN_GOOGLE_SUB to create an admin.');
    return;
  }
  await prisma.user.upsert({
    where: { email },
    update: { role: UserRole.ADMIN },
    create: { email, googleSub, displayName: 'Administrator', role: UserRole.ADMIN },
  });
  console.log(`Admin ready: ${email}`);
}

main().finally(() => prisma.$disconnect());
