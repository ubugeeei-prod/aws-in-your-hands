# The Firecracker API specification, reduced

`firecracker-v1.17.0.subset.json` is a part of the OpenAPI (Swagger 2.0) specification of
[Firecracker](https://github.com/firecracker-microvm/firecracker), converted from YAML to JSON.

| | |
| --- | --- |
| Source | <https://raw.githubusercontent.com/firecracker-microvm/firecracker/v1.17.0/src/firecracker/swagger/firecracker.yaml> |
| Tag | `v1.17.0` |
| SHA-256 of the source file | `473a0a392927b407834b341bf5fbc7925524fedaf9d925e1bbbafb6a1f48c671` |

## What was changed

The file is not the whole specification. It keeps the operations chapter 67 uses (listed as
`USED_OPERATIONS` in `../src/spec.ts`) and the definitions those operations refer to, and leaves
out everything else. A `source` object with the URL, the checksum and the license name was added
at the top. `extractSubset` in `../src/spec.ts` does the cutting, and `vp run firecracker:spec`
downloads the source again, checks the checksum, and compares the result with this file.

## License

Firecracker is licensed under the Apache License, Version 2.0, and this reduced file is
distributed under the same license. `LICENSE` and `NOTICE` in this directory are the files of
those names from the Firecracker repository at the tag `v1.17.0`, unmodified. `NOTICE` mentions a
`THIRD-PARTY` file; it is in the Firecracker repository at the same tag and is not copied here.
