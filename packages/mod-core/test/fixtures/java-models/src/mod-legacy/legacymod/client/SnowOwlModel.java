package legacymod.client;
import net.minecraft.client.renderer.model.Model; import net.minecraft.client.renderer.model.ModelRenderer;
public class SnowOwlModel extends Model {
  private final ModelRenderer body; private final ModelRenderer head; private final ModelRenderer leftWing;
  public SnowOwlModel() {
    this.field_78090_t = 64; this.field_78089_u = 64;
    this.body = new ModelRenderer(this, 0, 10);
    this.body.func_228300_a_(-3f, -8f, -3f, 6f, 8f, 6f);
    this.body.func_78793_a(0f, 22f, 0f);
    this.head = new ModelRenderer(this);
    this.head.func_78784_a(0, 0).func_228301_a_(-2.5f, -5f, -2.5f, 5f, 5f, 5f, 0.1f);
    this.head.func_78793_a(0f, -8f, 0f);
    this.body.func_78792_a(this.head);
    this.leftWing = new ModelRenderer(this, 24, 10);
    this.leftWing.field_78809_i = true;
    this.leftWing.func_228300_a_(0f, 0f, -2f, 1f, 6f, 5f);
    this.leftWing.func_78793_a(3f, -7f, 0f);
    setRotation(this.leftWing, 0f, 0f, -0.2617994f);
    this.body.func_78792_a(this.leftWing);
  }
  private void setRotation(ModelRenderer part, float x, float y, float z) { part.field_78795_f = x; part.field_78796_g = y; part.field_78808_h = z; }
}
