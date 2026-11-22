package net.neoforged.neoforge.registries;
import java.util.function.Supplier;
public class DeferredRegister<T> { public static <T> DeferredRegister<T> create(String registry, String modid) { return new DeferredRegister<>(); } public <I extends T> Supplier<I> register(String name, Supplier<I> factory) { return factory; } }
