import { InMemoryNoteRepository } from "../src/memory-repository.ts";
import { describeRepositoryContract } from "./repository-contract.ts";

describeRepositoryContract("in memory", async () => ({ repository: new InMemoryNoteRepository(), owner: "test" }));
