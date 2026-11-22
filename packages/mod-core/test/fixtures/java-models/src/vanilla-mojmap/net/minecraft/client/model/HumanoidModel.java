package net.minecraft.client.model;
import net.minecraft.client.model.geom.PartPose;
import net.minecraft.client.model.geom.builders.*;
public class HumanoidModel {
  public static MeshDefinition createMesh(CubeDeformation grow, float y) {
    MeshDefinition mesh = new MeshDefinition();
    PartDefinition root = mesh.getRoot();
    root.addOrReplaceChild("head", CubeListBuilder.create().texOffs(0, 0).addBox(-4f, -8f, -4f, 8f, 8f, 8f, grow), PartPose.offset(0f, y, 0f));
    root.addOrReplaceChild("body", CubeListBuilder.create().texOffs(16, 16).addBox(-4f, 0f, -2f, 8f, 12f, 4f, grow), PartPose.offset(0f, y, 0f));
    root.addOrReplaceChild("tail_from_game_files", CubeListBuilder.create().texOffs(0, 40).addBox(-1f, 0f, 2f, 2f, 2f, 6f), PartPose.offset(0f, 10f + y, 0f));
    return mesh;
  }
}
