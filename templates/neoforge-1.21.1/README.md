# {{display_name}}

{{description}}

Scaffolded by MineMods on {{year}}. Author: {{author}}. Licensed under {{license}}.

## Setup

Minecraft {{mc_version}} with NeoForge {{loader_version}}, built with ModDevGradle
{{mdg_version}} on Gradle {{gradle_version}}. Install Java 21 and set JAVA_HOME to it.

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
