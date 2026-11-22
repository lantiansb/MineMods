package fixturemod.client;
import fixturemod.ModEntities;
import net.minecraft.client.renderer.entity.MobRenderer;
import net.neoforged.neoforge.client.event.EntityRenderersEvent;
public class ClientSetup {
  public static void registerLayers(EntityRenderersEvent.RegisterLayerDefinitions event) {
    event.registerLayerDefinition(ModLayers.DEER, CrystalDeerModel::createBodyLayer);
    event.registerLayerDefinition(ModLayers.WALKER, SwampWalkerModel::create);
  }
  public static void registerRenderers(EntityRenderersEvent.RegisterRenderers event) {
    event.registerEntityRenderer(ModEntities.CRYSTAL_DEER.get(), CrystalDeerRenderer::new);
    event.registerEntityRenderer(ModEntities.PACK_WOLF.get(), PackWolfRenderer::new);
    event.registerEntityRenderer(ModEntities.SWAMP_WALKER.get(), context -> new MobRenderer<Object, SwampWalkerModel>(context, new SwampWalkerModel(context.bakeLayer(ModLayers.WALKER)), 0.5f) {});
  }
}
