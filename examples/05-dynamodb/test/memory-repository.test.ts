import { InMemoryNoteRepository } from "../src/memory-repository.ts";
import { describeQuotaContract, describeRepositoryContract } from "./repository-contract.ts";

describeRepositoryContract("in memory", async () => ({
  repository: new InMemoryNoteRepository(),
  owner: "test",
}));

describeQuotaContract("in memory", async (maxNotesPerOwner) => ({
  repository: new InMemoryNoteRepository(maxNotesPerOwner),
  owner: "test",
}));
