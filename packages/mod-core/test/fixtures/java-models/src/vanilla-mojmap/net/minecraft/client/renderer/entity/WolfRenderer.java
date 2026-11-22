package net.minecraft.client.renderer.entity;
import net.minecraft.client.model.WolfModel; import net.minecraft.client.model.geom.ModelLayers; import net.minecraft.resources.ResourceLocation;
public class WolfRenderer extends MobRenderer<Object, WolfModel> {
  private static final ResourceLocation WOLF_LOCATION = new ResourceLocation("minecraft", "textures/entity/wolf/wolf.png");
  public WolfRenderer(EntityRendererProvider.Context context) { super(context, new WolfModel(context.bakeLayer(ModelLayers.WOLF)), 0.5f); }
}
