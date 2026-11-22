import java.nio.file.*;
import com.google.gson.*;
import software.bernie.geckolib.loading.json.raw.*;
import software.bernie.geckolib.loading.object.BakedModelFactory;
import software.bernie.geckolib.cache.object.*;

class ReadCorners {
    public static void main(String[] args) throws Exception {
        var builder = new GsonBuilder();
        for (Class<?> type : new Class<?>[]{Cube.class, UVUnion.class, UVFaces.class, FaceUV.class, ModelProperties.class})
            builder.registerTypeAdapter(type, type.getMethod("deserializer").invoke(null));
        var gson = builder.create();
        var model = JsonParser.parseString(Files.readString(Path.of(args[0]))).getAsJsonObject()
            .getAsJsonArray("minecraft:geometry").get(0).getAsJsonObject();
        var props = gson.fromJson(model.get("description"), ModelProperties.class);
        var factory = new BakedModelFactory.Builtin();
        for (var entry : model.getAsJsonArray("bones")) {
            var bone = entry.getAsJsonObject();
            var cube = gson.fromJson(bone.getAsJsonArray("cubes").get(0), Cube.class);
            var baked = factory.constructCube(cube, props, new GeoBone(null, "root", false, 0.0, false, false));
            for (var quad : baked.quads()) for (var v : quad.vertices()) {
                var pos = v.position();
                System.out.println(bone.get("name").getAsString()+" "+quad.direction()+" "+pos.x()+" "+pos.y()+" "+pos.z()+" "+v.texU()+" "+v.texV());
            }
        }
    }
}
