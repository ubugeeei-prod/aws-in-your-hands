// #region statement
/** SQL whose text is fixed, and the values that go where its question marks are. */
export type Statement = { sql: string; parameters: readonly string[] };

const PARAMETER = Symbol("parameter");
const FRAGMENT = Symbol("fragment");

/** A value from outside. It travels beside the SQL, never inside it. */
export type Parameter = { [PARAMETER]: string };
/** A piece of SQL text this code wrote or checked against a list. */
export type Fragment = { [FRAGMENT]: string };
// #endregion statement

// #region values
// StartQueryExecution accepts 1 to 1,024 characters for each execution parameter.
const MAX_PARAMETER_LENGTH = 1024;
// Tab, line feed and carriage return are text. The other control characters are not.
const TEXT_CONTROLS = new Set([0x09, 0x0a, 0x0d]);
const isControl = (code: number) => (code < 0x20 && !TEXT_CONTROLS.has(code)) || code === 0x7f;

function parameter(literal: string): Parameter {
  if (literal.length > MAX_PARAMETER_LENGTH) {
    throw new Error(`An execution parameter holds at most ${MAX_PARAMETER_LENGTH} characters.`);
  }
  return { [PARAMETER]: literal };
}

/**
 * Athena reads an execution parameter as SQL, so a string must arrive as a
 * quoted literal. A quote inside it is doubled, which is how Athena's SQL
 * writes one.
 */
export function text(value: string): Parameter {
  if ([...value].some((character) => isControl(character.codePointAt(0) ?? 0))) {
    throw new Error("A text parameter cannot hold control characters.");
  }
  return parameter(`'${value.replaceAll("'", "''")}'`);
}

export function integer(value: number): Parameter {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Not a whole number: ${value}`);
  }
  return parameter(String(value));
}
// #endregion values

// #region fragments
/** A name that goes into the SQL text itself. It must be one of the names listed. */
export function identifier(name: string, allowed: readonly string[]): Fragment {
  if (!allowed.includes(name) || !/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new Error(`Not a known name: ${name}`);
  }
  return { [FRAGMENT]: name };
}

/** SQL text written in this repository. Never call it with a value that came from outside. */
export const trusted = (text: string): Fragment => ({ [FRAGMENT]: text });

/** Several fragments as one, for a column list. */
export const list = (fragments: readonly Fragment[], separator = ", "): Fragment =>
  trusted(fragments.map((fragment) => fragment[FRAGMENT]).join(separator));
// #endregion fragments

// #region sql
/**
 * A statement from a template. Each `${…}` is either a parameter, which becomes
 * a question mark, or a fragment, which becomes text. A bare string is neither,
 * so it does not compile, and it throws if it is forced through.
 */
export function sql(
  strings: TemplateStringsArray,
  ...values: readonly (Parameter | Fragment)[]
): Statement {
  let out = strings[0] ?? "";
  const parameters: string[] = [];
  values.forEach((value, index) => {
    if (typeof value === "object" && value !== null && PARAMETER in value) {
      parameters.push(value[PARAMETER]);
      out += "?";
    } else if (typeof value === "object" && value !== null && FRAGMENT in value) {
      out += value[FRAGMENT];
    } else {
      throw new Error("Only parameters and fragments can be placed in a statement.");
    }
    out += strings[index + 1] ?? "";
  });
  // A question mark in the text itself would be taken for a parameter and shift the rest.
  if (out.split("?").length - 1 !== parameters.length) {
    throw new Error("The SQL text of a statement cannot hold a question mark of its own.");
  }
  return { sql: out, parameters };
}
// #endregion sql

// #region inline
/**
 * The statement with its parameters written into the text. Only for statements
 * Athena does not accept parameters in (DDL, MERGE, OPTIMIZE), and only with
 * values this code has already checked: the result is ordinary string-built SQL.
 */
export function inline(statement: Statement): string {
  const values = [...statement.parameters];
  const text = statement.sql.replaceAll("?", () => {
    const value = values.shift();
    if (value === undefined) {
      throw new Error("The statement has more question marks than parameters.");
    }
    return value;
  });
  if (values.length > 0) {
    throw new Error("The statement has more parameters than question marks.");
  }
  return text;
}
// #endregion inline
