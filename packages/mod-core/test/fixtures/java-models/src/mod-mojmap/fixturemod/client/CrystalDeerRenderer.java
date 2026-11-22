package fixturemod.client;
import net.minecraft.client.renderer.entity.EntityRendererProvider; import net.minecraft.client.renderer.entity.MobRenderer; import net.minecraft.resources.ResourceLocation;
public class CrystalDeerRenderer extends MobRenderer<Object, CrystalDeerModel> {
  private static final ResourceLocation TEXTURE = ResourceLocation.fromNamespaceAndPath("fixturemod", "textures/entity/deer/crystal.png");
  public CrystalDeerRenderer(EntityRendererProvider.Context context) { super(context, new CrystalDeerModel(context.bakeLayer(ModLayers.DEER)), 0.6f); }
}
