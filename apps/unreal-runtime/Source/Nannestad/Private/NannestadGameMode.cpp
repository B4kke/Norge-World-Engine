#include "NannestadGameMode.h"

#include "Kismet/GameplayStatics.h"
#include "NannestadCharacter.h"
#include "NweWorldBootstrap.h"

ANannestadGameMode::ANannestadGameMode()
{
    DefaultPawnClass = ANannestadCharacter::StaticClass();
}

void ANannestadGameMode::StartPlay()
{
    Super::StartPlay();
    if (UWorld* World = GetWorld();
        World && !UGameplayStatics::GetActorOfClass(World, ANweWorldBootstrap::StaticClass()))
    {
        World->SpawnActor<ANweWorldBootstrap>(ANweWorldBootstrap::StaticClass(), FTransform::Identity);
    }
}
