package fixturemod.client;
import net.minecraft.client.model.HumanoidModel; import net.minecraft.client.model.geom.PartPose; import net.minecraft.client.model.geom.builders.*;
public class SwampWalkerModel {
  public SwampWalkerModel(net.minecraft.client.model.geom.ModelPart root) {}
  public static LayerDefinition create() {
    MeshDefinition mesh = HumanoidModel.createMesh(CubeDeformation.NONE, 0f);
    mesh.getRoot().addOrReplaceChild("hat", CubeListBuilder.create().texOffs(32, 0).addBox(-5f, -9f, -5f, 10f, 2f, 10f), PartPose.ZERO);
    return LayerDefinition.create(mesh, 64, 64);
  }
}
