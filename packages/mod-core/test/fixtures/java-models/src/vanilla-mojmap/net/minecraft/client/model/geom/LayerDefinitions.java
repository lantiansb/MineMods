package net.minecraft.client.model.geom;
import java.util.HashMap; import java.util.Map;
import net.minecraft.client.model.*; import net.minecraft.client.model.geom.builders.*;
public class LayerDefinitions {
  public static Map<ModelLayerLocation, LayerDefinition> createRoots() {
    Map<ModelLayerLocation, LayerDefinition> map = new HashMap<>();
    LayerDefinition player = LayerDefinition.create(HumanoidModel.createMesh(CubeDeformation.NONE, 0f), 64, 64);
    map.put(ModelLayers.PLAYER, player);
    map.put(ModelLayers.WOLF, WolfModel.createBodyLayer());
    return map;
  }
}
