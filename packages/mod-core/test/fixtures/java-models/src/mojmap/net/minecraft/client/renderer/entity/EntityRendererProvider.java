package net.minecraft.client.renderer.entity;
public interface EntityRendererProvider<T> { Object create(Context context);
  class Context { public net.minecraft.client.model.geom.ModelPart bakeLayer(net.minecraft.client.model.geom.ModelLayerLocation layer) { return new net.minecraft.client.model.geom.ModelPart(); } } }
