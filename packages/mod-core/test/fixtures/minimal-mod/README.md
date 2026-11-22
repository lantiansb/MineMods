# Fabric compatibility fixture

Generate an empty mod into a fresh directory with:

```powershell
bun test/fixtures/minimal-mod/scaffold.ts "path/to/中文 mod's project"
```

The scaffold uses the same explicit template resources and resolved profile as
Studio. Set `JAVA_HOME` to a Java 21 JDK and run the generated `gradlew.bat build`
(or `./gradlew build` on Unix). The artifact is
`build/libs/minimal_mod-0.1.0.jar`. Inspect its `fabric.mod.json` and Java
entrypoint before starting `runClient` or `runServer --args nogui`.

Dedicated server validation must respect the Minecraft EULA prompt. Do not
prepopulate `eula=true`. Runtime results belong in the task verification report,
including unsuccessful launches and the exact stopping condition.
