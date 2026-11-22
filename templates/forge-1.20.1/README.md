# {{display_name}}

{{description}}

Scaffolded by MineMods on {{year}}. Author: {{author}}. Licensed under {{license}}.

## Setup

Minecraft {{mc_version}} with Forge {{loader_version}}, built with ModDevGradle
{{mdg_version}} on Gradle {{gradle_version}}. Install Java 17 and set JAVA_HOME to it.

Forge 1.20.1 also needs Java 21 at build time: ModDevGradle's legacyforge plugin
makes the deobfuscated game jar on 21. Tell Gradle where both JDKs are, for example
`-Porg.gradle.java.installations.paths=<jdk17>,<jdk21>`.

The included Gradle wrapper verifies the downloaded distribution checksum. Build with:

```
./gradlew build
```

The mod jar is written to `build/libs/`. Run a Minecraft client with the mod loaded:

```
./gradlew runClient
```

On Windows use `./gradlew.bat` for these commands. Run a dedicated server with
`./gradlew runServer`. Read Minecraft's EULA before accepting it in the generated
`run/eula.txt`; MineMods does not accept it automatically.
