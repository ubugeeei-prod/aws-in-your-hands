{
  description = "AWS in Your Hands: pinned toolchain for the book, its site, and every example";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "aarch64-darwin"
        "x86_64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];
      forEachSystem = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      packages = forEachSystem (pkgs: {
        vp = pkgs.callPackage ./nix/vp.nix { };
      });

      devShells = forEachSystem (pkgs: {
        default = pkgs.mkShell {
          packages = [
            pkgs.nodejs_24
            pkgs.pnpm_10
            pkgs.awscli2
            pkgs.git
            self.packages.${pkgs.stdenv.hostPlatform.system}.vp
          ];

          # vp keeps its settings and downloads under VP_HOME. Pointing it at a
          # directory inside the checkout keeps this project from reading or
          # rewriting ~/.vite-plus, and nix/vp-home.json tells vp to use the
          # Node.js and pnpm that Nix put on PATH instead of downloading its own.
          #
          # On its first run with a new VP_HOME, vp 1.1.0 sets itself up there
          # and, unless told otherwise, appends a line to ~/.zshrc, ~/.zshenv,
          # ~/.bashrc, and ~/.profile. VP_SELF_SETUP_NO_MODIFY_PATH stops that:
          # entering this shell must not edit files in your home directory.
          shellHook = ''
            root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
            export VP_HOME="$root/.vp-home"
            export VP_SELF_SETUP_NO_MODIFY_PATH=1
            if [ ! -f "$VP_HOME/config.json" ]; then
              mkdir -p "$VP_HOME"
              cp "$root/nix/vp-home.json" "$VP_HOME/config.json"
              chmod u+w "$VP_HOME/config.json"
            fi
          '';
        };
      });
    };
}
