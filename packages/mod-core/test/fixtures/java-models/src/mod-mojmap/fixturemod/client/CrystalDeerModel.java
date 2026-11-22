package fixturemod.client;
import net.minecraft.client.model.geom.ModelPart; import net.minecraft.client.model.geom.PartPose; import net.minecraft.client.model.geom.builders.*;
public class CrystalDeerModel {
  public CrystalDeerModel(ModelPart root) {}
  public static LayerDefinition createBodyLayer() {
    MeshDefinition mesh = new MeshDefinition();
    PartDefinition root = mesh.getRoot();
    PartDefinition body = root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(0, 16).addBox(-3f, -4f, -8f, 6f, 8f, 16f), PartPose.offset(0f, 10f, 0f));
    PartDefinition head = body.addOrReplaceChild("head", CubeListBuilder.create().texOffs(0, 0).addBox(-2f, -6f, -4f, 4f, 6f, 6f, new CubeDeformation(0.25f)), PartPose.offsetAndRotation(0f, -4f, -8f, 0.5235988f, 0f, 0f));
    head.addOrReplaceChild("left_antler", CubeListBuilder.create().texOffs(40, 0).mirror().addBox(0f, -6f, 0f, 1f, 6f, 1f), PartPose.offsetAndRotation(1f, -6f, 0f, 0f, 0f, (float) Math.toRadians(20)));
    for (int i = 0; i < 4; i++) addLeg(root, "leg_" + i, i % 2 == 0 ? -2f : 2f, i < 2 ? -6f : 6f);
    return LayerDefinition.create(mesh, 64, 48);
  }
  private static void addLeg(PartDefinition root, String name, float x, float z) {
    root.addOrReplaceChild(name, CubeListBuilder.create().texOffs(28, 0).addBox(-1f, 0f, -1f, 2f, 10f, 2f), PartPose.offset(x, 14f, z));
  }
}
