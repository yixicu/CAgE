<script lang="ts">
 import type {ReportUpdate} from '../api';
 import ResearchPaper from '../ResearchPaper.svelte';
 let {update}:{update:ReportUpdate}=$props();
 const labels={queued:'Queued for review',pending:'Under review',confirmed:'Confirmed',conditional:'Conditional proof',unsupported:'Unsupported argument'};
</script>
<section class="notice" aria-label="Report correction">
 <strong>{labels[update.status]}</strong>
 <ResearchPaper content={update.body} />
 {#if update.claim}<p>Claim · {update.claim}</p>{/if}
 {#if update.inference}<p>Inference · {update.inference}</p>{/if}
 {#if update.condition}<p>Condition · {update.condition}</p>{/if}
 {#if update.review}<p>{update.review}</p>{/if}
</section>
