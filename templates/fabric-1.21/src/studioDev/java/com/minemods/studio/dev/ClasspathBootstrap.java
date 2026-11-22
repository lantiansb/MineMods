package com.minemods.studio.dev;

import java.lang.reflect.InvocationTargetException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/** Restores the complete development classpath before Fabric Loader discovers Minecraft. */
public final class ClasspathBootstrap {
    public static void main(String[] args) throws Throwable {
        System.setProperty("java.class.path", Files.readString(
                Path.of(System.getProperty("minemods.dev.classpath")), StandardCharsets.UTF_8));
        try {
            Class.forName("net.fabricmc.devlaunchinjector.Main")
                    .getMethod("main", String[].class).invoke(null, (Object) args);
        } catch (InvocationTargetException exception) {
            throw exception.getCause();
        }
    }
}
