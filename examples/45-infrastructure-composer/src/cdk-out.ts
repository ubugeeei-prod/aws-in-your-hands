// Which file in a cdk.out directory holds the template of a stack.

const SUFFIX = ".template.json";

export type Choice = { ok: true; file: string } | { ok: false; reason: string };

// #region choose
/** Picks `<stack>.template.json` among the file names of a cdk.out directory. */
export function chooseTemplate(files: readonly string[], stack: string | undefined): Choice {
  const stacks = files
    .filter((file) => file.endsWith(SUFFIX))
    .map((file) => file.slice(0, -SUFFIX.length))
    .sort();
  if (stacks.length === 0) {
    return { ok: false, reason: "no *.template.json here: run the chapter's synth task first" };
  }
  if (stack === undefined) {
    const [only = ""] = stacks;
    return stacks.length === 1
      ? { ok: true, file: only + SUFFIX }
      : { ok: false, reason: `name one of: ${stacks.join(", ")}` };
  }
  return stacks.includes(stack)
    ? { ok: true, file: stack + SUFFIX }
    : { ok: false, reason: `no stack ${stack}; there is: ${stacks.join(", ")}` };
}
// #endregion choose
