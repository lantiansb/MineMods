package fabricmod.client;
import fabricmod.ModEntities;
import net.fabricmc.fabric.api.client.rendering.v1.EntityModelLayerRegistry; import net.fabricmc.fabric.api.client.rendering.v1.EntityRendererRegistry;
import net.minecraft.class_2960; import net.minecraft.class_5601;
public class FabricClient {
  public static final class_5601 FOX_LAYER = new class_5601(new class_2960("fabricmod", "ember_fox"), "main");
  public void onInitializeClient() {
    EntityModelLayerRegistry.registerModelLayer(FOX_LAYER, EmberFoxModel::getTexturedModelData);
    EntityRendererRegistry.register(ModEntities.EMBER_FOX, EmberFoxRenderer::new);
  }
}
