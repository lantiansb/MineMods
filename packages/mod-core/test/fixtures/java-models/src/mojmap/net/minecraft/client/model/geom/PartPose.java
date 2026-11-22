package net.minecraft.client.model.geom;
public class PartPose { public static final PartPose ZERO = new PartPose();
  public static PartPose offset(float x, float y, float z) { return ZERO; }
  public static PartPose rotation(float x, float y, float z) { return ZERO; }
  public static PartPose offsetAndRotation(float x, float y, float z, float rx, float ry, float rz) { return ZERO; } }
