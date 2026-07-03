import { ensureSeedData } from "../src/routes/admin.routes.js";
import { prisma } from "../src/lib/prisma.js";

await ensureSeedData();
await prisma.$disconnect();
