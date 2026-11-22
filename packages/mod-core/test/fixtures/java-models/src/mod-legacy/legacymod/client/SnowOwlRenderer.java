package legacymod.client;
import net.minecraft.client.renderer.entity.MobRenderer;
public class SnowOwlRenderer extends MobRenderer<Object, SnowOwlModel> {
  private static final String TEXTURE = "legacymod:textures/entity/snow_owl.png";
  public SnowOwlRenderer(Object manager) { super(manager, new SnowOwlModel(), 0.3f); }
}
