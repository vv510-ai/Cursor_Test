from manim import *


class SceneBinaryTreeTraversal(Scene):
    def construct(self):
        title = Text("二叉树前序遍历", font_size=40, color=GREEN).to_edge(UP)
        positions = {
            "A": UP * 1.4,
            "B": LEFT * 2 + DOWN * 0.2,
            "C": RIGHT * 2 + DOWN * 0.2,
            "D": LEFT * 3 + DOWN * 1.8,
            "E": LEFT + DOWN * 1.8,
            "F": RIGHT + DOWN * 1.8,
            "G": RIGHT * 3 + DOWN * 1.8,
        }
        edges = [("A", "B"), ("A", "C"), ("B", "D"), ("B", "E"), ("C", "F"), ("C", "G")]
        nodes = {key: Circle(radius=0.38, color=BLUE).move_to(pos) for key, pos in positions.items()}
        labels = {key: Text(key, font_size=26).move_to(pos) for key, pos in positions.items()}
        lines = VGroup(*[
            Line(nodes[parent].get_bottom(), nodes[child].get_top(), color=GREY_B)
            for parent, child in edges
        ])

        self.play(Write(title), Create(lines), *[Create(node) for node in nodes.values()])
        self.play(*[FadeIn(label) for label in labels.values()])

        order = ["A", "B", "D", "E", "C", "F", "G"]
        order_text = Text("访问顺序: ", font_size=28).to_edge(DOWN)
        self.play(FadeIn(order_text))
        visited = []
        for key in order:
            marker = SurroundingRectangle(nodes[key], color=YELLOW, buff=0.08)
            visited.append(key)
            next_text = Text("访问顺序: " + " → ".join(visited), font_size=28).to_edge(DOWN)
            self.play(Create(marker), Transform(order_text, next_text), run_time=0.35)
            self.play(FadeOut(marker), run_time=0.15)
        self.wait(1)
