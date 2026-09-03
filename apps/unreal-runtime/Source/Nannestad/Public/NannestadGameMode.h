#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "NannestadGameMode.generated.h"

UCLASS()
class NANNESTAD_API ANannestadGameMode : public AGameModeBase
{
    GENERATED_BODY()

public:
    ANannestadGameMode();
    virtual void StartPlay() override;
};
