package net.minecraft.client.model;
import net.minecraft.client.model.geom.ModelPart;
import net.minecraft.client.model.geom.PartPose;
import net.minecraft.client.model.geom.builders.*;
public class WolfModel { public WolfModel(ModelPart root) {}
  public static LayerDefinition createBodyLayer() {
    MeshDefinition mesh = new MeshDefinition();
    PartDefinition root = mesh.getRoot();
    root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(0, 0).addBox(-2f, -3f, -2f, 6f, 6f, 4f), PartPose.offset(-1f, 13.5f, -7f));
    root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(18, 14).addBox(-3f, -2f, -3f, 6f, 9f, 6f), PartPose.offsetAndRotation(0f, 14f, 2f, 1.5707964f, 0f, 0f));
    return LayerDefinition.create(mesh, 64, 32);
  }
}
