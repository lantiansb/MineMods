package net.neoforged.neoforge.client.event;
import java.util.function.Supplier;
import net.minecraft.client.model.geom.ModelLayerLocation; import net.minecraft.client.model.geom.builders.LayerDefinition;
import net.minecraft.client.renderer.entity.EntityRendererProvider; import net.minecraft.world.entity.EntityType;
public class EntityRenderersEvent {
  public static class RegisterLayerDefinitions { public void registerLayerDefinition(ModelLayerLocation layer, Supplier<LayerDefinition> supplier) {} }
  public static class RegisterRenderers { public <T> void registerEntityRenderer(EntityType<? extends T> type, EntityRendererProvider<T> provider) {} }
}
