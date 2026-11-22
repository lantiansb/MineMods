/** What the real machine printed when a download broke off, with nothing wrong in the mod. */
export const HANDSHAKE = `> Task :remapJar FAILED
Execution failed for task ':remapJar'.
> Could not download lwjgl-glfw-3.3.3-natives-windows.jar (org.lwjgl:lwjgl-glfw:3.3.3)
   > Could not GET 'https://libraries.minecraft.net/org/lwjgl/lwjgl-glfw/3.3.3/lwjgl-glfw-3.3.3-natives-windows.jar'.
      > Remote host terminated the handshake
BUILD FAILED in 1m 3s
`
/** A compile error, which is the mod's own and is never retried. */
export const COMPILE = `> Task :compileJava FAILED
/build/src/main/java/com/minemods/Main.java:11: error: cannot find symbol
Execution failed for task ':compileJava'.
> Compilation failed; see the compiler error output for details.
BUILD FAILED in 9s
`
