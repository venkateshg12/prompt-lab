/** `--name value` from argv. Checks -1 first: args[indexOf + 1] reads args[0] when the flag is absent. No imports, so file-only scripts need no env. */
export const flag = (args: string[], name: string): string | undefined => {
    const index = args.indexOf(name);
    return index !== -1 ? args[index + 1] : undefined;
};
