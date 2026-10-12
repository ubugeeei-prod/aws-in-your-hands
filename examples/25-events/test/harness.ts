import { createLocal } from "../src/local.ts";

/** A fresh bus, consumers, and clock for one test. */
export const setup = () => createLocal();
