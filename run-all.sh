#!/bin/bash
W="--words words.json"
{
node loadtest.js smoke $W
node loadtest.js abuse --slow $W
node loadtest.js load --pairs 50 --ramp 10 $W
node loadtest.js spike --pairs 200 $W
node loadtest.js storm --pairs 100 $W
node loadtest.js breakpoint $W
} 2>&1 | tee results-$1.txt
