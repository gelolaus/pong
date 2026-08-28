import { z } from "zod";

export const questionSchema = z
  .object({
    id: z.string().min(1),
    prompt: z.string().min(1),
    imageUrl: z.string().url().optional(),
    answers: z.array(z.string().min(1)).min(2).max(4),
    correctIndex: z.number().int().nonnegative(),
    explanation: z.string().min(1),
    timerSeconds: z.number().int().min(5).max(120),
  })
  .superRefine((question, context) => {
    if (question.correctIndex >= question.answers.length) {
      context.addIssue({
        code: "custom",
        message: "correctIndex must identify an answer.",
        path: ["correctIndex"],
      });
    }
  });

export const quizSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  questions: z.array(questionSchema).length(20),
});

export type Question = z.infer<typeof questionSchema>;
export type Quiz = z.infer<typeof quizSchema>;

const answers = ["Programming language", "Pokemon"];

export const eventQuiz: Quiz = quizSchema.parse({
  id: "programming-language-or-pokemon",
  title: "Programming Language or Pokemon",
  questions: [
    ["clojure", "Clojure", 0, "Clojure is a functional programming language for the JVM."],
    ["elixir", "Elixir", 0, "Elixir is a functional programming language built for the Erlang VM."],
    ["haskell", "Haskell", 0, "Haskell is a statically typed functional programming language."],
    ["kotlin", "Kotlin", 0, "Kotlin is a modern programming language that runs on the JVM."],
    ["fortran", "Fortran", 0, "Fortran is a programming language widely used for scientific computing."],
    ["scala", "Scala", 0, "Scala is a programming language that combines object-oriented and functional styles."],
    ["zig", "Zig", 0, "Zig is a systems programming language."],
    ["racket", "Racket", 0, "Racket is a general-purpose programming language in the Lisp family."],
    ["prolog", "Prolog", 0, "Prolog is a logic programming language."],
    ["cobol", "COBOL", 0, "COBOL is a programming language designed for business data processing."],
    ["pikachu", "Pikachu", 1, "Pikachu is an Electric-type Pokemon."],
    ["charizard", "Charizard", 1, "Charizard is a Fire- and Flying-type Pokemon."],
    ["bulbasaur", "Bulbasaur", 1, "Bulbasaur is a Grass- and Poison-type Pokemon."],
    ["eevee", "Eevee", 1, "Eevee is a Pokemon known for multiple possible evolutions."],
    ["gengar", "Gengar", 1, "Gengar is a Ghost- and Poison-type Pokemon."],
    ["snorlax", "Snorlax", 1, "Snorlax is a Normal-type Pokemon."],
    ["lugia", "Lugia", 1, "Lugia is a Psychic- and Flying-type Pokemon."],
    ["mewtwo", "Mewtwo", 1, "Mewtwo is a Psychic-type Legendary Pokemon."],
    ["jigglypuff", "Jigglypuff", 1, "Jigglypuff is a Normal- and Fairy-type Pokemon."],
    ["rayquaza", "Rayquaza", 1, "Rayquaza is a Dragon- and Flying-type Legendary Pokemon."],
  ].map(([id, prompt, correctIndex, explanation]) => ({
    id,
    prompt,
    answers,
    correctIndex,
    explanation,
    timerSeconds: 20,
  })),
});
