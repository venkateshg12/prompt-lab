import { config } from "@repo/eslint-config/base";

export default [
    ...config,
    { ignores: ["dist/**"] },
    {
        rules: {
            // The copied e-commerce code uses `any` in a few deliberate places (job payload unions).
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-unused-vars": [
                "warn",
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                    caughtErrorsIgnorePattern: "^_",
                    ignoreRestSiblings: true,
                },
            ],
        },
    },
    {
        // Files tagged COPY in docs/reference/copy-map.md must stay byte-identical to their
        // e-commerce source, so their style findings are silenced here instead of "fixed".
        files: [
            "src/utils/rateLimiter/**",
            "src/middleware/visitorId.ts",
            "src/services/gmail.service.ts",
            "src/types/verificationLink.types.ts",
        ],
        rules: {
            "@typescript-eslint/no-unused-vars": "off",
            "@typescript-eslint/no-wrapper-object-types": "off",
            "no-control-regex": "off",
            "prefer-const": "off",
            "turbo/no-undeclared-env-vars": "off",
        },
    },
];
