package net.minecraft.client.model;
public class ModelRenderer {
  public float rotationPointX, rotationPointY, rotationPointZ, rotateAngleX, rotateAngleY, rotateAngleZ; public boolean mirror;
  public ModelRenderer(ModelBase model, int u, int v) {}
  public ModelRenderer addBox(float x, float y, float z, int w, int h, int d) { return this; }
  public void addBox(float x, float y, float z, int w, int h, int d, float grow) {}
  public void setRotationPoint(float x, float y, float z) {}
  public void addChild(ModelRenderer child) {}
  public ModelRenderer setTextureSize(int w, int h) { return this; }
}
