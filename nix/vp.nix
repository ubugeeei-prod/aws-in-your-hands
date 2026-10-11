# Vite+ global CLI (`vp`), taken from the platform-specific npm tarballs that
# upstream publishes. nixpkgs has no vite-plus attribute at the pinned revision
# (and `nixpkgs#vp` is an unrelated image viewer), so the binary is fetched by
# fixed hash here. Keep `version` equal to the `vite-plus` devDependency in
# package.json: this binary delegates run/check/test/build to that package.
{
  lib,
  stdenvNoCC,
  fetchurl,
  autoPatchelfHook,
  stdenv,
}:
let
  version = "1.1.0";
  # integrity values copied from the npm registry metadata of each package.
  sources = {
    aarch64-darwin = {
      name = "darwin-arm64";
      hash = "sha512-PFpvpBUCqlvS1f2oCsNHnJSFHT7SOK/QeCJwhs/GLcvtOyyAY4tT6QmxyZzom4D33g63GfZ6y25e3yyFkchncg==";
    };
    x86_64-darwin = {
      name = "darwin-x64";
      hash = "sha512-fjkt6aSsgfVZlc4EmLrAazA0PeFzsdSnRfGbh7fWn5UWGQJLiz0LDvCUyLcfmGoZQqDjhwkwBun2YkK1leNTnQ==";
    };
    aarch64-linux = {
      name = "linux-arm64-gnu";
      hash = "sha512-b0LzCEUoFiuezkGqp7153FygQlHUZ4ffyEatJ2U0R25g13vcjQ4sgqn9d1Nbdkw3eQQ/T5scb1TUS1YSc4IOzw==";
    };
    x86_64-linux = {
      name = "linux-x64-gnu";
      hash = "sha512-lNnY8ULsZ1AdO1DiSDqHWfxq1kT91aUroMFFq2ROSG3SyP1cmmNkCvMdOiYlNPh1P8DamBYG2q2JoqUJlA4kMQ==";
    };
  };
  source =
    sources.${stdenvNoCC.hostPlatform.system}
      or (throw "vp ${version} is not packaged here for ${stdenvNoCC.hostPlatform.system}");
in
stdenvNoCC.mkDerivation {
  pname = "vite-plus-cli";
  inherit version;

  src = fetchurl {
    url = "https://registry.npmjs.org/@voidzero-dev/vite-plus-cli-${source.name}/-/vite-plus-cli-${source.name}-${version}.tgz";
    inherit (source) hash;
  };

  # Only the Linux glibc builds need their interpreter patched for the Nix store.
  nativeBuildInputs = lib.optionals stdenvNoCC.hostPlatform.isLinux [ autoPatchelfHook ];
  buildInputs = lib.optionals stdenvNoCC.hostPlatform.isLinux [ stdenv.cc.cc.lib ];

  dontConfigure = true;
  dontBuild = true;
  sourceRoot = "package";

  installPhase = ''
    runHook preInstall
    install -Dm755 vp $out/bin/vp
    ln -s vp $out/bin/vpr
    runHook postInstall
  '';

  meta = {
    description = "Vite+ global CLI";
    homepage = "https://viteplus.dev/";
    license = lib.licenses.mit;
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
    platforms = builtins.attrNames sources;
    mainProgram = "vp";
  };
}
