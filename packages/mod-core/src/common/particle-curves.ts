import { particleCurves, type ParticleDocument } from "../particle"

export function particleCurveJava(pkg: string, documents: ParticleDocument[]) {
  const rows = documents.map(
    (doc) =>
      "{" +
      particleCurves(doc)
        .map((knots) => "{" + knots.join(", ") + "}")
        .join(", ") +
      "}",
  )
  return `package ${pkg};

final class StudioParticleCurves {
    private static final double[][][] CURVES = {${rows.join(",\n        ")}};
    static float at(int spec, int channel, double part) {
        double[] knots = CURVES[spec][channel];
        part = Math.max(0.0, Math.min(1.0, part));
        for (int i = 2; i < knots.length; i += 2) {
            if (part > knots[i]) continue;
            double t = (part - knots[i - 2]) / (knots[i] - knots[i - 2]);
            return (float)(knots[i - 1] + (knots[i + 1] - knots[i - 1]) * t);
        }
        return (float)knots[knots.length - 1];
    }
}
`
}
