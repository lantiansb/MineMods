# {{display_name}}

{{description}}

Scaffolded by MineMods on {{year}}. Author: {{author}}. Licensed under {{license}}.

## Setup

Install Java 21 and set JAVA_HOME to its installation directory. The included
Gradle 8.8 wrapper verifies the downloaded distribution checksum. Build with:

```
./gradlew build
```

Run a Minecraft client with the mod loaded:

```
./gradlew runClient
```

On Windows use `./gradlew.bat` for these commands. Run a dedicated server with
`./gradlew runServer --args nogui`. Read Minecraft's EULA before accepting it in
the generated `run/eula.txt`; MineMods does not accept it automatically.

The `studioDev` source set supports long paths containing Chinese and other
Unicode characters when running the development client or server. Keep it with
the exported project. It is compiled only for development launches and is not
included in the mod JAR.

## Versions

- Minecraft: {{mc_version}}
- Fabric Loader: {{fabric_loader_version}}
- Fabric API: {{fabric_api_version}}
- Yarn mappings: {{yarn_mappings}}
- Java: {{java_version}}
- Loom: 1.7.4
- Gradle: 8.8
- GeckoLib: 4.8.3
