package fabricmod.client;
import net.minecraft.class_2960; import net.minecraft.class_5617; import net.minecraft.class_927;
public class EmberFoxRenderer extends class_927<Object, EmberFoxModel> {
  private static final class_2960 TEXTURE = new class_2960("fabricmod", "textures/entity/ember_fox.png");
  public EmberFoxRenderer(class_5617.class_5618 context) { super(context, new EmberFoxModel(context.method_32167(FabricClient.FOX_LAYER)), 0.4f); }
}
