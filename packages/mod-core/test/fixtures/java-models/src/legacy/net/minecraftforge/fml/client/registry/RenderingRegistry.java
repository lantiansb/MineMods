package net.minecraftforge.fml.client.registry;
public class RenderingRegistry { public interface IRenderFactory<T> { Object createRenderFor(Object manager); } public static <T> void registerEntityRenderingHandler(Object type, IRenderFactory<? super T> factory) {} }
