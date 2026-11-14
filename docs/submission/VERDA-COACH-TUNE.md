# Five-line note for Verda's Discord (coach-tune lane)

> **Geppetto (Junction 2026): our own hand-skills coach, labelled, trained and served on Verda Serverless Containers.**
> Gemma 4 31B (bf16, vLLM, 1x H100) wrote 3,231 coaching lines from our glove data in 35 s; no Gemini output was used for training.
> A LoRA on Gemma 4 E2B trained in 167 s on one H100. It matches its 31B teacher on our held-out test (89.0% vs 85.7%); untuned it scores 55.5%. Training labels were filtered for correctness.
> Every coaching hint can come from this model: it answers in 0.108 s p50 from Helsinki, 3 times faster than the teacher; the whole run cost 5.72 USD at list price.
> An expert's hand movements are their know-how, so the data and the model stay on European compute with open weights.
