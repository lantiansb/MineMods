package fabricmod.client;
import net.minecraft.class_5603; import net.minecraft.class_5605; import net.minecraft.class_5606; import net.minecraft.class_5607; import net.minecraft.class_5609; import net.minecraft.class_5610; import net.minecraft.class_630;
public class EmberFoxModel {
  public EmberFoxModel(class_630 root) {}
  public static class_5607 getTexturedModelData() {
    class_5609 data = new class_5609();
    class_5610 root = data.method_32111();
    class_5610 body = root.method_32117("body", class_5606.method_32108().method_32101(24, 15).method_32097(-3f, 4f, -3.5f, 6f, 11f, 6f), class_5603.method_32091(0f, 16f, -6f, 1.5707964f, 0f, 0f));
    root.method_32117("head", class_5606.method_32108().method_32101(1, 5).method_32098(-3f, -2f, -5f, 8f, 6f, 6f, new class_5605(0.5f)), class_5603.method_32090(-1f, 16.5f, -3f));
    body.method_32117("tail", class_5606.method_32108().method_32101(30, 0).method_32096().method_32097(2f, 0f, -1f, 4f, 9f, 5f), class_5603.method_32091(-4f, 15f, -1f, -0.05235988f, 0f, 0f));
    return class_5607.method_32110(data, 48, 32);
  }
}
