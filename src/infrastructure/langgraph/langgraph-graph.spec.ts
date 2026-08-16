import { Annotation, END, MemorySaver, START, StateGraph } from '@langchain/langgraph';
import { describe, expect, it } from 'vitest';

const GraphState = Annotation.Root({
  value: Annotation<number>({
    default: () => 0,
    reducer: (_left, right) => right,
  }),
});

describe('LangGraph foundation', () => {
  it('compiles and invokes a checkpointed graph', async () => {
    const graph = new StateGraph(GraphState)
      .addNode('increment', (state) => ({ value: state.value + 1 }))
      .addEdge(START, 'increment')
      .addEdge('increment', END)
      .compile({ checkpointer: new MemorySaver() });

    const result = await graph.invoke(
      { value: 1 },
      { configurable: { thread_id: 'foundation-test' } },
    );

    expect(result.value).toBe(2);
  });
});
