# Gradle wrapper provenance

`gradle-wrapper.jar`, `../../gradlew` and `../../gradlew.bat` are the same unmodified
copies of the official Gradle `v8.8.0` wrapper that the Fabric template carries
(Apache-2.0); the wrapper starts any Gradle version, and Studio checks the JAR's
SHA-256 before every build.

| File | SHA-256 |
| --- | --- |
| `gradle-wrapper.jar` | `cb0da6751c2b753a16ac168bb354870ebb1e162e9083f116729cec9c781156b8` |
| `../../gradlew` | `9647c972efcd020ea8aa71deec05f78e7bb01f3ceb623e3662cae6890ffae619` |
| `../../gradlew.bat` | `e54283c0f86074fa408c1161d08ef8f63992323a8c940c66f3626e8abc5bd8cc` |

The wrapper downloads Gradle {{gradle_version}}; `gradle-wrapper.properties` pins
its SHA-256 (`distributionSha256Sum`), taken from Studio's target manifest, which
copied it from Gradle's published `.sha256` file.
