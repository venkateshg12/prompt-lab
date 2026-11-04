import "dotenv/config";
import { prisma } from "../db/prisma";
import { seedModels } from "../services/model.service";

// pnpm --filter api db:seed-models   (MODELS_SEED=test seeds only the fake:* rows)
seedModels()
    .then((r) => console.log(r.created + r.updated === 0 ? "models unchanged" : `models: ${r.created} created, ${r.updated} updated, ${r.unchanged} unchanged`))
    .catch((e) => {
        console.error(e);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
