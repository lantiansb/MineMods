package legacymod.client;
import net.minecraft.client.model.ModelBase; import net.minecraft.client.model.ModelRenderer;
public class ModelMossGolem extends ModelBase {
  public ModelRenderer torso; public ModelRenderer arm;
  public ModelMossGolem() {
    textureWidth = 128; textureHeight = 64;
    torso = new ModelRenderer(this, 0, 0);
    torso.addBox(-6f, -12f, -4f, 12, 12, 8);
    torso.setRotationPoint(0f, 12f, 0f);
    arm = new ModelRenderer(this, 40, 0);
    arm.addBox(-2f, 0f, -2f, 4, 14, 4, 0.5f);
    arm.setRotationPoint(8f, -10f, 0f);
    arm.rotateAngleZ = -0.1745329f;
    torso.addChild(arm);
  }
}
