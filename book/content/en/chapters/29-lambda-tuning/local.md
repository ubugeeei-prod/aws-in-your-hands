---
title: "29 Lambda Tuning: Run It Locally"
---

# 29 Lambda Tuning: Run It Locally

## Measuring locally

<!-- section: 29.local -->

This page runs the code from the [pages so far](/en/chapters/29-lambda-tuning/more.md) without AWS. What can be measured locally is the size of the bundle and the time Node.js takes to load it. It needs no credentials and costs nothing.

```bash
vp run tune:bundle
```

The task bundles the same function five ways into `examples/29-lambda-tuning/dist/`, loads each in a new Node.js process, and times it. That imitates, on your machine, the first thing a new execution environment does.

<<< @/examples/29-lambda-tuning/src/bundle/measure.ts{load}

Only the time of the `import` is measured; starting Node.js itself is not in it. The five variants are loaded once each in turn, again and again, so that if the machine gets busy with other work, all five are affected alike.

On a Mac (Apple silicon, Node.js 24.21.0), with 31 loads each, the result was this.

```text
node v24.21.0, darwin arm64, 31 loads each

variant                    bytes        gzip   load, median    fastest
as-chapter-05         1350.2 KiB   236.5 KiB        80.8 ms    58.9 ms
module-first           921.6 KiB   170.0 KiB        68.8 ms    46.2 ms
minified               350.6 KiB   107.4 KiB        64.5 ms    47.1 ms
aggregated-client      396.2 KiB   119.0 KiB        72.9 ms    51.6 ms
sdk-external            21.9 KiB     7.4 KiB        80.4 ms    56.7 ms
```

The bytes are the same on every run. The times are not. Other work was running on the same machine at the time, and over three runs in a row the medians moved by 20 to 30% from run to run. What did not change in any of the three was the order: the minified bundle was fastest, and the bundle with chapter 05's settings and the one without the SDK were slowest. Measured again with 15 loads each while the machine was quiet, the medians all fell between 47.8 and 58.5 milliseconds, and the differences were smaller still.

Two things can be read from this table, and no more.

- Making the bundle a quarter of its size shortened the load time by only about 20%. Bytes and time are not proportional
- The bundle without the SDK is the smallest and not fast. It has to read the SDK from the many files in `node_modules`

There is more that cannot be read from it. Before loading, Lambda downloads the code and unpacks it. That is the part where the size of the bundle should matter, and this measurement does not include it. The CPU differs too. A 256 MB function is allocated about a seventh of a vCPU, so it is natural to expect the same load to take longer than on your machine, but that was not measured. And without the SDK in the bundle, what Lambda reads is the SDK in the runtime, which differs from your `node_modules` in layout and in version.

**Time on your machine is not time on Lambda.** The table compares five variants on one machine and does not tell you how many milliseconds any of them takes in AWS. The only way to know is to [deploy and measure](/en/chapters/29-lambda-tuning/deploy.md).

After the table the output continues, for each bundle, with how many KiB each package takes. That is where to look when the budget is exceeded. The last line says whether the deployed bundle is within its budget, and the task fails if it is not.

The other two tasks are arithmetic and a summary.

```bash
vp run tune:plan
vp run tune:report:sample
```

`tune:plan` prints the order of the timeouts, the cost at each memory setting, and the cost of provisioned concurrency. You can give it your own function's numbers, as in `--memory 512 --ms 30 --requests 5000000 --provisioned 2`. The unit prices are read from `data/pricing/`. `tune:report:sample` is the summary shown on the [first page](/en/chapters/29-lambda-tuning.md).

Run the tests with this command.

```bash
vp run test:unit
```

The tests check the reading of REPORT lines and `platform.report`, the billed duration, the concurrency model, the order of the timeouts, the deadline against a table that does not answer, the bundle budget, and the stack's template. The bundle tests claim nothing about time. A test on a number that moves from run to run is a test that fails for no reason.

What is not reproduced locally:

- The execution environment itself: downloading the code, starting the environment, freezing and thawing, and the replacement every few hours
- The memory setting and the CPU that goes with it. A local process uses the machine's CPU as it is
- The concurrency limits and throttling. The model copies the rules; it does not measure what Lambda does
- The REPORT lines Lambda writes. What you have locally are the lines copied from the documentation
- The function timeout. The deadline tests fire the signal by hand
