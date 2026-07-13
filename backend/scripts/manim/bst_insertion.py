from manim import *


class SceneBstInsertion(Scene):
    def construct(self):
        title = Text("二叉搜索树插入", font_size=40, color=GREEN).to_edge(UP)
        root = Circle(radius=0.42, color=BLUE).shift(UP * 1.1)
        left = Circle(radius=0.42, color=BLUE).shift(LEFT * 2 + DOWN * 0.5)
        right = Circle(radius=0.42, color=BLUE).shift(RIGHT * 2 + DOWN * 0.5)
        labels = VGroup(
            Text("8", font_size=26).move_to(root),
            Text("4", font_size=26).move_to(left),
            Text("12", font_size=26).move_to(right),
        )
        edges = VGroup(Line(root.get_bottom(), left.get_top()), Line(root.get_bottom(), right.get_top()))
        candidate = VGroup(Circle(radius=0.42, color=YELLOW), Text("10", font_size=26)).shift(LEFT * 4 + UP * 0.2)
        hint = Text("10 > 8, 向右", font_size=26).to_edge(DOWN)

        self.play(Write(title), Create(edges), Create(root), Create(left), Create(right), FadeIn(labels))
        self.play(FadeIn(candidate), Write(hint))
        self.play(candidate.animate.next_to(root, RIGHT, buff=0.8), run_time=0.8)
        next_hint = Text("10 < 12, 向左", font_size=26).to_edge(DOWN)
        self.play(Transform(hint, next_hint))
        self.play(candidate.animate.next_to(right, LEFT + DOWN, buff=0.8), run_time=0.8)

        insert_edge = Line(right.get_bottom(), candidate[0].get_top(), color=YELLOW)
        done = Text("插入完成", font_size=28, color=GREEN).to_edge(DOWN)
        self.play(Create(insert_edge), candidate[0].animate.set_color(GREEN), Transform(hint, done))
        self.wait(1)
